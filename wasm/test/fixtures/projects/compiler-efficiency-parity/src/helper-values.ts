let calls = 0
export const shared = () => { calls += 1; return calls }
export const alias = shared
export const distinct = () => { calls += 1; return calls }
