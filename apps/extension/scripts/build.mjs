import { mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.cwd());
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const file of ['manifest.json', 'sidepanel.html', 'popup.html']) {
  await cp(path.join(root, file), path.join(root, 'dist', file));
}
await cp(path.join(root, 'src'), path.join(root, 'dist', 'src'), { recursive: true });
console.log('Extension build complete (static copy).');
