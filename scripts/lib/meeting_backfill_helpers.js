import path from 'node:path';

const readFlagValue = (args, flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

export const parseBackfillArgs = (args) => {
  const write = args.includes('--write');

  return {
    dryRun: !write,
    write,
    dbPath: readFlagValue(args, '--db'),
    meetingId: readFlagValue(args, '--meeting-id'),
    title: readFlagValue(args, '--title'),
  };
};

export const resolvePlutoDbPath = ({
  explicitDbPath = null,
  env = process.env,
  platform = process.platform,
  homeDir = process.env.HOME || process.env.USERPROFILE || '',
  appName = 'pluto',
} = {}) => {
  if (explicitDbPath) return explicitDbPath;
  if (env.PLUTO_DB_PATH) return env.PLUTO_DB_PATH;

  if (platform === 'darwin') {
    return path.join(
      homeDir,
      'Library',
      'Application Support',
      appName,
      'pluto.db',
    );
  }

  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, appName, 'pluto.db');
  }

  const configHome = env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  return path.join(configHome, appName, 'pluto.db');
};

export const buildMeetingWhereClause = ({ meetingId, title }) => {
  if (meetingId) {
    return {
      clause: 'WHERE id = ?',
      params: [meetingId],
      description: `meeting id ${meetingId}`,
    };
  }

  if (title) {
    return {
      clause: 'WHERE title LIKE ?',
      params: [`%${title}%`],
      description: `title containing "${title}"`,
    };
  }

  throw new Error('Provide --meeting-id or --title');
};
