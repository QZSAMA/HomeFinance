import assert from 'node:assert/strict';

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function compareManifest(expected, actual, label) {
  try {
    assert.deepEqual(canonicalize(actual), canonicalize(expected));
  } catch (error) {
    throw new Error(`${label} mismatch: ${error.message}`);
  }
}
