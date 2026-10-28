// 在建置前自動解析 git remote，把 GitHub repo 資訊寫進 src/config/repo.json
// 這樣前端程式碼會自動知道要跟哪個 repo 同步（部署到 Cloudflare Pages 時也會自動生效）
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = 'src/config/repo.json';

function resolveGit() {
  try {
    const url = execSync('git remote get-url origin', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.#?]+)/i);
    if (m) return { owner: m[1], repo: m[2] };
  } catch {
    /* 尚未 git init 或沒有 remote */
  }
  return null;
}

const current = existsSync(target)
  ? JSON.parse(readFileSync(target, 'utf8'))
  : null;

const git = resolveGit();
const repoName = git?.repo || current?.repo || 'taste-journal'
const next = {
  owner: git?.owner || current?.owner || '',
  repo: repoName,
  dataRepo: `${repoName}-data`,
  branch:
    process.env.CF_PAGES_BRANCH ||
    process.env.CF_PAGES_COMMIT_REF ||
    current?.branch ||
    'main',
};

if (JSON.stringify(current) !== JSON.stringify(next)) {
  writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
  console.log(`[resolve-repo] ${next.owner || '（尚未連結 GitHub）'}/${next.repo} @ ${next.branch}`);
} else {
  console.log(`[resolve-repo] 維持現有設定：${next.owner || '（尚未連結 GitHub）'}/${next.repo} @ ${next.branch}`);
}
