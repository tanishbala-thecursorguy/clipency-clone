// deno-lint-ignore no-explicit-any
export function createClient(..._a: any[]): any { return { rpc: async (..._b: any[]) => ({ data: null, error: null }), auth: { getUser: async (..._c: any[]) => ({ data: null }) } }; }
