import pg from '../../artifacts/phase2a5/runtime/node_modules/pg/lib/index.js';
let db;
process.on('message', async (m) => {
  try {
    if (m.type === 'connect') {
      if (m.config.user.split('.').at(-1) !== 'ibulqvolmfouvkqczqhs') throw Error('Wrong staging');
      db = new pg.Client(m.config);
      await db.connect();
      if (!db.connection.stream.authorized) throw Error('TLS verification failed');
      const r = await db.query('select pg_backend_pid() pid');
      process.send({ id: m.id, ok: true, pid: process.pid, backend: r.rows[0].pid });
    } else if (m.type === 'query') {
      const r = await db.query(m.text, m.values);
      process.send({ id: m.id, ok: true, rows: r.rows });
    } else if (m.type === 'delay') {
      await db.query(m.text, m.values);
      process.send({ id: m.id, progress: 'provider-started' });
      if (m.crash) process.exit(23);
      await new Promise((r) => setTimeout(r, 900));
      process.send({ id: m.id, ok: true });
    } else if (m.type === 'close') {
      await db?.end();
      process.send({ id: m.id, ok: true });
      process.exit(0);
    }
  } catch (e) {
    process.send?.({
      id: m.id,
      ok: false,
      code: /^[A-Z0-9]{5}$/.test(e.code ?? '') ? e.code : 'TEST_FAILURE',
    });
  }
});
