const { spawnSync } = require('node:child_process');
const { YOUTUBE_DL_PATH } = require('yt-dlp-exec/src/constants');

async function main() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const rebuild = spawnSync(npmCommand, ['rebuild', 'yt-dlp-exec'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (rebuild.error) throw rebuild.error;
  if (rebuild.status !== 0) {
    throw new Error(`npm rebuild yt-dlp-exec failed with exit code ${rebuild.status}.`);
  }

  const versionResult = spawnSync(YOUTUBE_DL_PATH, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (versionResult.error) throw versionResult.error;
  if (versionResult.status !== 0) {
    throw new Error(`yt-dlp --version failed: ${String(versionResult.stderr || '').trim()}`);
  }

  const installedVersion = String(versionResult.stdout || '').trim();
  const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ringo-discord-music-bot',
    },
  });
  if (!response.ok) {
    throw new Error(`Could not verify latest yt-dlp release: HTTP ${response.status}.`);
  }

  const release = await response.json();
  const latestVersion = String(release.tag_name || '').replace(/^v/, '');
  if (!latestVersion) throw new Error('GitHub did not return a yt-dlp release version.');
  if (installedVersion !== latestVersion) {
    throw new Error(`yt-dlp refresh is stale: installed ${installedVersion}, latest ${latestVersion}.`);
  }

  process.stdout.write(`yt-dlp ${installedVersion} is current.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
