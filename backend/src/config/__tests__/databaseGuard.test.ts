import {
  databaseCredentialProblem,
  enforceDatabaseCredential,
  enforceDatabaseRole,
} from '../databaseGuard';
import logger from '../../utils/logger';

describe('databaseCredentialProblem', () => {
  it('accepts a real password', () => {
    expect(databaseCredentialProblem('postgresql://cozyvtt:s3cr3t-and-long@database:5432/cozyvtt')).toBeNull();
  });

  it.each([
    'postgresql://cozyvtt:CHANGE_ME_TO_SECURE_PASSWORD@database:5432/cozyvtt',
    'postgresql://cozyvtt:CHANGE_ME@database:5432/cozyvtt',
    'postgresql://cozyvtt:CHANGE_ME_TO_SECURE_PASSWORD@localhost/cozyvtt?schema=public',
  ])('names the placeholder in %s', (url) => {
    expect(databaseCredentialProblem(url)).toMatch(/placeholder/);
  });

  it('names an unset or malformed URL', () => {
    expect(databaseCredentialProblem(undefined)).toMatch(/not set/);
    expect(databaseCredentialProblem('not a url')).toMatch(/not a valid/);
  });
});

describe('enforceDatabaseCredential', () => {
  const placeholder = 'postgresql://cozyvtt:CHANGE_ME_TO_SECURE_PASSWORD@database:5432/cozyvtt';

  it('exits in production on the placeholder', () => {
    const exit = jest.fn();
    enforceDatabaseCredential({ DATABASE_URL: placeholder, NODE_ENV: 'production' }, exit);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('only warns outside production', () => {
    const exit = jest.fn();
    enforceDatabaseCredential({ DATABASE_URL: placeholder, NODE_ENV: 'development' }, exit);
    expect(exit).not.toHaveBeenCalled();
  });

  it('prints commands for the bootstrap superuser and the schema owner the URL names', () => {
    const logged = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    enforceDatabaseCredential(
      { DATABASE_URL: 'postgresql://tabletop:CHANGE_ME@database:5432/games', NODE_ENV: 'production' },
      jest.fn()
    );
    const message = String(logged.mock.calls[0][0]);
    logged.mockRestore();
    expect(message).toContain(
      `docker compose exec database psql -U cozyvtt -d games -c "ALTER USER cozyvtt WITH PASSWORD '<new>';"`
    );
    expect(message).toContain(
      `docker compose exec database psql -U cozyvtt -d games -c "ALTER USER tabletop WITH PASSWORD '<new>';"`
    );
    expect(message).toContain('DATABASE_APP_PASSWORD');
  });

  it('prints the default schema owner for the shipped Compose URL', () => {
    const logged = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    enforceDatabaseCredential(
      {
        DATABASE_URL: 'postgresql://cozyvtt_app:CHANGE_ME_TO_SECURE_PASSWORD@database:5432/cozyvtt',
        NODE_ENV: 'production',
      },
      jest.fn()
    );
    const message = String(logged.mock.calls[0][0]);
    logged.mockRestore();
    expect(message).toContain(
      `docker compose exec database psql -U cozyvtt -d cozyvtt -c "ALTER USER cozyvtt WITH PASSWORD '<new>';"`
    );
    expect(message).toContain(
      `docker compose exec database psql -U cozyvtt -d cozyvtt -c "ALTER USER cozyvtt_app WITH PASSWORD '<new>';"`
    );
  });

  it('does nothing with a real password in production', () => {
    const exit = jest.fn();
    enforceDatabaseCredential({ DATABASE_URL: 'postgresql://u:real-password-here@db:5432/x', NODE_ENV: 'production' }, exit);
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('enforceDatabaseRole', () => {
  const env = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:real-password-here@db:5432/x' };

  it('exits in production when the connected role is a superuser', async () => {
    const exit = jest.fn();
    const logged = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    await enforceDatabaseRole(env, exit, async () => true);
    const message = String(logged.mock.calls[0][0]);
    logged.mockRestore();
    expect(exit).toHaveBeenCalledWith(1);
    expect(message).toMatch(/\[FATAL\]/);
    expect(message).toMatch(/schema owner/);
    expect(message).toMatch(/not a superuser|non-superuser/);
    expect(message).not.toContain(env.DATABASE_URL);
  });

  it('does not exit in production when the connected role is not a superuser', async () => {
    const exit = jest.fn();
    await enforceDatabaseRole(env, exit, async () => false);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits in production when the role cannot be checked', async () => {
    const exit = jest.fn();
    const logged = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    await enforceDatabaseRole(env, exit, async () => {
      throw new Error('connection refused');
    });
    const message = String(logged.mock.calls[0][0]);
    logged.mockRestore();
    expect(exit).toHaveBeenCalledWith(1);
    expect(message).toMatch(/\[FATAL\]/);
    expect(message).toMatch(/not a superuser/);
    expect(message).not.toContain(env.DATABASE_URL);
  });

  it.each(['development', 'test'])('does not exit in %s when the connected role is a superuser', async (nodeEnv) => {
    const exit = jest.fn();
    await enforceDatabaseRole({ NODE_ENV: nodeEnv, DATABASE_URL: env.DATABASE_URL }, exit, async () => true);
    expect(exit).not.toHaveBeenCalled();
  });

  (process.env.DATABASE_URL ? it : it.skip)(
    'reads rolsuper for the connected role when DATABASE_URL is set',
    async () => {
      const exit = jest.fn();
      await enforceDatabaseRole({ NODE_ENV: 'test' }, exit);
      expect(exit).not.toHaveBeenCalled();
    }
  );
});
