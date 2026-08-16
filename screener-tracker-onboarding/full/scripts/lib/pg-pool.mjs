export function observePoolErrors(pool, { logger = (line) => console.error(line) } = {}) {
  pool.on('error', (error) => {
    logger(`[postgres] idle client error: ${error.message}`);
  });
  return pool;
}
