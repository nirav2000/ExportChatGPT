import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Asset, Chat, Message, Project, WorkspaceSnapshot } from '@project-archivist/schema';
import { makeSafeUniqueName, sanitizeFileName } from '@project-archivist/core';

function messageToMarkdown(msg: Message, assets: Map<string, Asset>): string {
  const header = `### ${msg.role}`;
  const body = msg.blocks
    .map((b) => {
      switch (b.type) {
        case 'paragraph':
          return b.text;
        case 'heading':
          return `${'#'.repeat(b.level)} ${b.text}`;
        case 'list':
          return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${it}`).join('\n');
        case 'code':
          return `\n\
\`\`\`${b.language ?? ''}\n${b.code}\n\`\`\``;
        case 'image': {
          const a = assets.get(b.assetId);
          return a ? `![${b.alt ?? a.alt ?? ''}](assets/${a.fileName})` : '[missing image]';
        }
        case 'link':
          return `[${b.text}](${b.href})`;
        case 'quote':
          return `> ${b.text}`;
        case 'table':
          return [
            `| ${b.headers.join(' | ')} |`,
            `| ${b.headers.map(() => '---').join(' | ')} |`,
            ...b.rows.map((r) => `| ${r.join(' | ')} |`),
          ].join('\n');
        default:
          return b.html;
      }
    })
    .join('\n\n');
  return `${header}\n\n${body}`;
}

function chatToHtml(chat: Chat, messages: Message[], markdown: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${chat.title}</title></head><body><h1>${chat.title}</h1><pre>${markdown.replace(/</g, '&lt;')}</pre><hr/><small>messages:${messages.length}</small></body></html>`;
}

export async function exportWorkspace(snapshot: WorkspaceSnapshot, rootDir: string): Promise<string> {
  const base = path.join(rootDir, 'Project Archivist Export');
  await mkdir(base, { recursive: true });

  const projectById = new Map(snapshot.projects.map((p) => [p.id, p]));
  const chatsByProject = new Map<string | null, Chat[]>();
  for (const chat of snapshot.chats) {
    const key = chat.projectId ?? null;
    chatsByProject.set(key, [...(chatsByProject.get(key) ?? []), chat]);
  }

  for (const project of snapshot.projects) {
    const projectDir = path.join(base, 'projects', sanitizeFileName(project.name));
    await mkdir(path.join(projectDir, 'chats'), { recursive: true });
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
  }

  const usedStandalone = new Set<string>();
  for (const chat of snapshot.chats) {
    const project = chat.projectId ? projectById.get(chat.projectId) : undefined;
    const baseFolder = `${chat.updatedAt?.slice(0, 10) ?? 'undated'} - ${sanitizeFileName(chat.title)}`;
    const folderName = project ? sanitizeFileName(baseFolder) : makeSafeUniqueName(baseFolder, usedStandalone);
    const chatDir = project
      ? path.join(base, 'projects', sanitizeFileName(project.name), 'chats', folderName)
      : path.join(base, 'standalone-chats', folderName);
    await mkdir(path.join(chatDir, 'assets'), { recursive: true });

    const msgs = snapshot.messages.filter((m) => m.chatId === chat.id);
    const chatAssets = snapshot.assets.filter((a) => a.chatId === chat.id);
    const assetMap = new Map(chatAssets.map((a) => [a.id, a]));
    const md = msgs.map((m) => messageToMarkdown(m, assetMap)).join('\n\n---\n\n');

    await writeFile(path.join(chatDir, 'chat.json'), JSON.stringify({ chat, messages: msgs, assets: chatAssets }, null, 2));
    await writeFile(path.join(chatDir, 'chat.md'), md);
    await writeFile(path.join(chatDir, 'chat.html'), chatToHtml(chat, msgs, md));
  }

  await writeFile(
    path.join(base, 'manifest.json'),
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        version: snapshot.version,
        projects: snapshot.projects.length,
        chats: snapshot.chats.length,
        messages: snapshot.messages.length,
        assets: snapshot.assets.length,
      },
      null,
      2,
    ),
  );

  return base;
}

export type { WorkspaceSnapshot, Project, Chat, Message, Asset };
