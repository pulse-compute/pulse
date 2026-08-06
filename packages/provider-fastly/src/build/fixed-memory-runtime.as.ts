/*
 * Fixed-memory AssemblyScript runtime for guest-linked Fastly Native modules.
 *
 * The ES256 guest contract reserves [0, 262144) for Rust, [262144, 524288)
 * for primary static data, and [524288, 540928) for the private invocation
 * frame. Dynamic primary allocations use [540928, 2097152). The allocator
 * reclaims and coalesces blocks and asks the mark/sweep runtime to collect
 * before reporting exhaustion. It contains no memory.grow instruction.
 */

import {
  AL_MASK,
  BLOCK_MAXSIZE,
  BLOCK_OVERHEAD,
} from "~lib/rt/common"
import "~lib/rt/itcms"

const PRIMARY_HEAP_START: usize = 540928
const PRIMARY_HEAP_END: usize = 2097152
const FREE: usize = 1
const MIN_PAYLOAD: usize =
  ((1 + BLOCK_OVERHEAD + AL_MASK) & ~AL_MASK) - BLOCK_OVERHEAD

@lazy let startOffset: usize =
  ((PRIMARY_HEAP_START + BLOCK_OVERHEAD + AL_MASK) & ~AL_MASK) - BLOCK_OVERHEAD
@lazy let endOffset: usize = startOffset
@lazy let collecting: bool = false

@inline function computeSize(size: usize): usize {
  return ((size + BLOCK_OVERHEAD + AL_MASK) & ~AL_MASK) - BLOCK_OVERHEAD
}

@inline function blockSize(block: usize): usize {
  return load<usize>(block) & ~FREE
}

@inline function blockIsFree(block: usize): bool {
  return (load<usize>(block) & FREE) != 0
}

function allocateFromFree(block: usize, actualSize: usize, size: usize): usize {
  const remaining = actualSize - size
  if (remaining >= BLOCK_OVERHEAD + MIN_PAYLOAD) {
    const next = block + BLOCK_OVERHEAD + size
    store<usize>(next, (remaining - BLOCK_OVERHEAD) | FREE)
    store<usize>(block, size)
  } else {
    store<usize>(block, actualSize)
  }
  return block + BLOCK_OVERHEAD
}

function tryAllocate(size: usize): usize {
  let cursor = startOffset
  while (cursor < endOffset) {
    const actualSize = blockSize(cursor)
    if (blockIsFree(cursor) && actualSize >= size) {
      return allocateFromFree(cursor, actualSize, size)
    }
    cursor += BLOCK_OVERHEAD + actualSize
  }
  const nextEnd = endOffset + BLOCK_OVERHEAD + size
  if (nextEnd > PRIMARY_HEAP_END) return 0
  const block = endOffset
  endOffset = nextEnd
  store<usize>(block, size)
  return block + BLOCK_OVERHEAD
}

function coalesce(): void {
  let cursor = startOffset
  while (cursor < endOffset) {
    let actualSize = blockSize(cursor)
    let next = cursor + BLOCK_OVERHEAD + actualSize
    if (blockIsFree(cursor)) {
      while (next < endOffset && blockIsFree(next)) {
        actualSize += BLOCK_OVERHEAD + blockSize(next)
        store<usize>(cursor, actualSize | FREE)
        next = cursor + BLOCK_OVERHEAD + actualSize
      }
      if (next == endOffset) {
        endOffset = cursor
        return
      }
    }
    cursor = next
  }
}

@unsafe @global
export function __alloc(size: usize): usize {
  if (size > BLOCK_MAXSIZE) unreachable()
  const payloadSize = computeSize(size)
  let pointer = tryAllocate(payloadSize)
  if (pointer == 0 && !collecting) {
    collecting = true
    __collect()
    collecting = false
    coalesce()
    pointer = tryAllocate(payloadSize)
  }
  if (pointer == 0) unreachable()
  return pointer
}

@unsafe @global
export function __realloc(pointer: usize, size: usize): usize {
  if (pointer == 0 || (pointer & AL_MASK) != 0) unreachable()
  const block = pointer - BLOCK_OVERHEAD
  const actualSize = blockSize(block)
  const payloadSize = computeSize(size)
  if (payloadSize <= actualSize) {
    const remaining = actualSize - payloadSize
    if (remaining >= BLOCK_OVERHEAD + MIN_PAYLOAD) {
      const next = block + BLOCK_OVERHEAD + payloadSize
      store<usize>(block, payloadSize)
      store<usize>(next, (remaining - BLOCK_OVERHEAD) | FREE)
      coalesce()
    }
    return pointer
  }
  const right = block + BLOCK_OVERHEAD + actualSize
  if (right < endOffset && blockIsFree(right)) {
    const combined = actualSize + BLOCK_OVERHEAD + blockSize(right)
    if (combined >= payloadSize) {
      return allocateFromFree(block, combined, payloadSize)
    }
  }
  const newPointer = __alloc(max<usize>(payloadSize, actualSize << 1))
  for (let index: usize = 0; index < actualSize; index += 1) {
    store<u8>(newPointer + index, load<u8>(pointer + index))
  }
  __free(pointer)
  return newPointer
}

@unsafe @global
export function __free(pointer: usize): void {
  if (pointer == 0 || (pointer & AL_MASK) != 0) unreachable()
  const block = pointer - BLOCK_OVERHEAD
  store<usize>(block, blockSize(block) | FREE)
  coalesce()
}

@unsafe @global
export function __reset(): void {
  endOffset = startOffset
}
