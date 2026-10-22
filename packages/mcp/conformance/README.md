# MCP binding conformance

The package owns static HTTP/MCP framing and projects the selected Entities
schemas. Entities owns validation and operation execution. The repository task
`mcp-native-binding` builds a separate five-tool fixture through normal Node
Native and Fastly Native compilation and compares protocol cases with the
original Node JavaScript application. Fastly execution in this task uses the
injected ABI; real CLI/Viceroy and client qualification are separate gates.

Root and `/node` fixed-backend host compatibility run independently through
`mcp-http`, `mcp-tools`, `mcp-compatibility`, and `mcp-authorization`.
