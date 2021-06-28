import { group, test, assert, assertEquals, assertThrows } from "../tests.ts";
import { UUIDv4, UUID } from "./uuid.ts";

group(import.meta, () => {

    group("UUIDv4", () => {

        test("parse and format a UUIDv4", () => {
            const parsed = new UUIDv4("6996ddbf-6cd0-4541-9ee9-3c37f8028941");
            assertEquals(parsed.toString(), "6996ddbf-6cd0-4541-9ee9-3c37f8028941");
        });

        test("parse a UUIDv4 in non-standard form", () => {
                const parsed = new UUIDv4("6996DDBF6cd045419EE93C37f8028941");
                assertEquals(parsed.toString(), "6996ddbf-6cd0-4541-9ee9-3c37f8028941");
        });

        test("can parse the nil UUID", () => {
                const parsed = new UUIDv4("00000000-0000-0000-0000-000000000000");
                assertEquals(parsed.toString(), "00000000-0000-0000-0000-000000000000");
        });

        test("create a UUIDv4", () => {
                const uuid = new UUIDv4();
                assertEquals(uuid.toString().length, 36);
                // Check round trip
                assertEquals(uuid.toString(), new UUIDv4(uuid.toString()).toString());
        });

        test("create unique UUIDs", () => {
                const hundredUuidStrings = Array.from({length:100},() => new UUIDv4().toString());
                const stringSet = new Set(hundredUuidStrings);
                assertEquals(stringSet.size, 100);
        });

        test("throw if string is not a valid UUIDv4", () => {
                assertThrows(() => new UUIDv4(""), undefined, `Invalid UUID string ""`);
                assertThrows(() => new UUIDv4("this is not a UUID"), undefined, `Invalid UUID string "this is not a UUID"`);
                assertThrows(() => new UUIDv4("00000000-ALEX-0000-0000-000000000000"), undefined, `Invalid UUID string "00000000-ALEX-0000-0000-000000000000"`);
        });

        test("serializes to JSON", () => {
                const uuid = new UUIDv4("6996ddbf-6cd0-4541-9ee9-3c37f8028941");
                assertEquals(JSON.stringify(uuid), `"6996ddbf-6cd0-4541-9ee9-3c37f8028941"`);
        });

        test("serializes to BigInt", () => {
                assertEquals(new UUIDv4("00000000-0000-0000-0000-000000000000").toBigInt(), 0n);
                assertEquals(new UUIDv4("00000000-0000-0000-0000-000000000001").toBigInt(), 1n);
                assertEquals(new UUIDv4("00000000-0000-0000-0000-000000c0ffee").toBigInt(), BigInt(0xc0ffee));
                assertEquals(new UUIDv4("6996ddbf-6cd0-4541-9ee9-3c37f8028941").toBigInt(), 140352281664974002727793031314151737665n);
        });

        test("is sortable", () => {
            const uuid1 = new UUIDv4("abcdef00-6cd0-4541-9ee9-3c37f8028941");
            const uuid2 = new UUIDv4("ffffffff-6cd0-4541-9ee9-3c37f8028941");
            assert(uuid1 < uuid2);
            assert(!(uuid1 > uuid2));
            assert(uuid2 > uuid1);
            assert(!(uuid2 < uuid1));
        });
    });

    group("UUID", () => {

        test("Generate a new UUID as a string", () => {
            const uuid = UUID();
            assertEquals(typeof uuid, "string");
            assertEquals(uuid.length, 36);
            assertEquals(uuid, new UUIDv4(uuid).toString());
        });

        test("parse aa UUIDv4 as a string", () => {
            const parsed = UUID("6996ddbf-6cd0-4541-9ee9-3c37f8028941");
            assertEquals(typeof parsed, "string");
            assertEquals(parsed, "6996ddbf-6cd0-4541-9ee9-3c37f8028941");
        });

        test("Normalize a UUID", () => {
            assertEquals(UUID("6996DDBF6cd045419EE93C37f8028941"), "6996ddbf-6cd0-4541-9ee9-3c37f8028941");
        });

        test("can normalize the nil UUID", () => {
            assertEquals(UUID("00000000-0000-0000-0000-000000000000"), "00000000-0000-0000-0000-000000000000");
            assertEquals(UUID("0000000000000000-0000-0000-0000-0000"), "00000000-0000-0000-0000-000000000000");
            assertEquals(UUID("00000000000000000000000000000000"), "00000000-0000-0000-0000-000000000000");
        });

        test("throw if string is not a valid UUIDv4", () => {
            assertThrows(() => UUID(""), undefined, `Invalid UUID string ""`);
            assertThrows(() => UUID("this is not a UUID"), undefined, `Invalid UUID string "this is not a UUID"`);
            assertThrows(() => UUID("00000000-ALEX-0000-0000-000000000000"), undefined, `Invalid UUID string "00000000-ALEX-0000-0000-000000000000"`);
        });
    });
});
