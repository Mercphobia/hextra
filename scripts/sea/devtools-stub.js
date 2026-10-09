// Stub for react-devtools-core: Ink only lazily imports it on its devtools
// path, which never executes in production. The real package cannot be
// bundled (top-level await) and cannot load inside a SEA binary.
export default {};
