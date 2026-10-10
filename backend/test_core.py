import asyncio
import unittest
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient
from pglast import parse_sql
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from .cursors import encode_cursor,decode_cursor,fingerprint
from .main import create_app,Settings,MessageIn


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.settings=Settings(database_url="postgresql://localhost/pudi",redis_url="redis://localhost:6379",
                               allowed_origins=["http://localhost:5173"],cursor_signing_key="x"*48)
        self.app=create_app(self.settings)

    def test_cursor_integrity_and_query_binding(self):
        uid=uuid4();q=fingerprint({"radius":50});value=encode_cursor("x"*48,q,50.25,uid)
        self.assertEqual(decode_cursor("x"*48,value,q),(50.25,uid))
        for bad,qhash in [(value+"!",q),(value,fingerprint({"radius":100}))]:
            with self.assertRaises(ValueError):decode_cursor("x"*48,bad,qhash)

    def test_blank_or_oversized_chat_rejected(self):
        for body in ["   ","x"*2001]:
            with self.assertRaises(ValidationError):
                MessageIn.model_validate({"type":"message","client_message_id":str(uuid4()),"body":body})

    def test_sql_parses(self):
        for path in list(Path("database").glob("*.sql"))+[Path("backend/search.sql")]:
            with self.subTest(path=path):self.assertTrue(parse_sql(path.read_text()))

    def test_invalid_search_does_not_reach_database(self):
        async def run():
            transport=httpx.ASGITransport(app=self.app)
            async with httpx.AsyncClient(transport=transport,base_url="http://test") as client:
                for params in [{"longitude":181,"latitude":-24},{"longitude":29,"latitude":-91},{"longitude":29,"latitude":-24,"radius_km":500},{"longitude":29,"latitude":-24,"purpose":"unknown"}]:
                    self.assertEqual((await client.get("/api/listings/nearby",params=params)).status_code,422)
        asyncio.run(run())

    def test_geojson_and_parameterized_search_contract(self):
        uid=uuid4()
        row={"id":uid,"title":"Boer goats","category":"goats","breed":"Boer","town":"Mankweng",
             "price_cents":320000,"quantity":12,"image_url":None,"purpose":["breeding"],
             "seller_name":"Mokgadi Livestock","is_verified_seller":True,
             "geometry":{"type":"Point","coordinates":[29.74,-23.88]},"distance_m":27100.0}
        class Pool:
            async def fetch(inner,sql,*args):
                self.assertEqual(args[2],50000);self.assertIn("ST_DWithin",sql)
                return [row]
        self.app.state.pool=Pool()
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url="http://test") as client:
                r=await client.get("/api/listings/nearby",params={"longitude":29.4689,"latitude":-23.9045})
                self.assertEqual(r.status_code,200);self.assertEqual(r.headers["content-type"],"application/geo+json")
                self.assertEqual(r.headers["cache-control"],"no-store")
                body=r.json();self.assertEqual(body["features"][0]["properties"]["price_cents"],320000)
                self.assertEqual(body["features"][0]["geometry"],row["geometry"])
        asyncio.run(run())

    def test_chat_rejects_untrusted_origin_before_room_access(self):
        client=TestClient(self.app)  # Deliberately skip lifespan; no database is needed for this rejection.
        with self.assertRaises(WebSocketDisconnect):
            with client.websocket_connect(f"/api/ws/conversations/{uuid4()}",headers={"origin":"https://untrusted.invalid"}):pass


if __name__=="__main__":unittest.main()
