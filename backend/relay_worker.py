"""Long-running Redis publisher for the transactional chat outbox.

Run as a Vercel Daemon (or another durable worker), not inside API instances.
"""

import asyncio
import json
import logging
import os
import signal

import asyncpg
from redis.asyncio import Redis

from backend.main import relay_outbox

log = logging.getLogger("pudi.relay")


async def init_connection(conn):
    await conn.set_type_codec("jsonb", schema="pg_catalog", encoder=json.dumps, decoder=json.loads)


async def run():
    database_url = os.environ["DATABASE_URL"]
    redis_url = os.environ["REDIS_URL"]
    namespace = os.getenv("REDIS_NAMESPACE", "pudi:production")

    pool = await asyncpg.create_pool(
        database_url,
        min_size=1,
        max_size=5,
        command_timeout=10,
        server_settings={
            "statement_timeout": "8000",
            "application_name": "pudi-outbox-relay",
        },
        init=init_connection,
    )
    redis = Redis.from_url(
        redis_url,
        decode_responses=True,
        socket_timeout=5,
        socket_connect_timeout=5,
        max_connections=32,
    )
    current_task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, current_task.cancel)

    try:
        await redis.ping()
        log.info("Pudi chat outbox relay started")
        await relay_outbox(pool, redis, namespace)
    finally:
        log.info("Stopping Pudi chat outbox relay")
        await redis.aclose()
        await pool.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        asyncio.run(run())
    except asyncio.CancelledError:
        pass
