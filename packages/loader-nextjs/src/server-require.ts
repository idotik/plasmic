import type { promises as FS } from 'fs';

let secretRequire: NodeRequire | undefined;
try {
  // Secretly use require without webpack knowing
  secretRequire = eval('require');
} catch (err) {
  secretRequire = undefined;
}

export default function serverRequire(module: string) {
  if (!secretRequire) {
    throw new Error(
      `Unexpected serverRequire() -- can only do this from a Node server!`
    );
  }
  return secretRequire(module);
}

export function serverRequireFs() {
  return serverRequire('fs').promises as typeof FS;
}
