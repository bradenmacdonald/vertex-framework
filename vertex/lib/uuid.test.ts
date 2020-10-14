import { registerSuite, assert } from "./intern-tests";
import { UUIDv4, UUID, normalizeUUID } from "./uuid";

registerSuite("UUIDv4 Class", {
    tests: {
        "parse and format a UUIDv4"() {
            const parsed = new UUIDv4("6996ddbf-6cd0-4541-9ee9-3c37f8028941");
            assert.equal(parsed.toString(), "6996ddbf-6cd0-4541-9ee9-3c37f8028941");
        },
        "parse a UUIDv4 in non-standard form"() {
            const parsed = new UUIDv4("6996DDBF6cd045419EE93C37f8028941");
            assert.equal(parsed.toString(), "6996ddbf-6cd0-4541-9ee9-3c37f8028941");
        },
        "can parse the nil UUID"() {
            const parsed = new UUIDv4("00000000-0000-0000-0000-000000000000");
            assert.equal(parsed.toString(), "00000000-0000-0000-0000-000000000000");
        },
        "create a UUIDv4"() {
            const uuid = new UUIDv4();
            assert.lengthOf(uuid.toString(), 36);
            // Check round trip
            assert.equal(uuid.toString(), new UUIDv4(uuid.toString()).toString());
        },
        "create unique UUIDs"() {
            const hundredUuidStrings = Array.from({length:100},() => new UUIDv4().toString());
            const stringSet = new Set(hundredUuidStrings);
            assert.equal(stringSet.size, 100);
        },
        "throw if string is not a valid UUIDv4"() {
            assert.throws(() => new UUIDv4(""), `Invalid UUID string ""`);
            assert.throws(() => new UUIDv4("this is not a UUID"), `Invalid UUID string "this is not a UUID"`);
            assert.throws(() => new UUIDv4("00000000-ALEX-0000-0000-000000000000"), `Invalid UUID string "00000000-ALEX-0000-0000-000000000000"`);
        },
        "serializes to JSON"() {
            const uuid = new UUIDv4("6996ddbf-6cd0-4541-9ee9-3c37f8028941");
            assert.equal(JSON.stringify(uuid), `"6996ddbf-6cd0-4541-9ee9-3c37f8028941"`);
        },
        "is sortable"() {
            const uuid1 = new UUIDv4("abcdef00-6cd0-4541-9ee9-3c37f8028941");
            const uuid2 = new UUIDv4("ffffffff-6cd0-4541-9ee9-3c37f8028941");
            assert.isTrue(uuid1 < uuid2);
            assert.isFalse(uuid1 > uuid2);
            assert.isTrue(uuid2 > uuid1);
            assert.isFalse(uuid2 < uuid1);
        },
    },
});

registerSuite("UUID", {
    tests: {
        "Generate a new UUID as a string"() {
            const uuid = UUID();
            assert.isString(uuid);
            assert.lengthOf(uuid, 36);
            assert.equal(uuid, new UUIDv4(uuid).toString());
        },
    },
});

registerSuite("normalizeUUID", {
    tests: {
        "parse aa UUIDv4 as a string"() {
            const parsed = normalizeUUID("6996ddbf-6cd0-4541-9ee9-3c37f8028941");
            assert.isString(parsed);
            assert.equal(parsed, "6996ddbf-6cd0-4541-9ee9-3c37f8028941");
        },
        "Normalize a UUID"() {
            assert.equal(normalizeUUID("6996DDBF6cd045419EE93C37f8028941"), "6996ddbf-6cd0-4541-9ee9-3c37f8028941");
        },
        "can normalize the nil UUID"() {
            assert.equal(normalizeUUID("00000000-0000-0000-0000-000000000000"), "00000000-0000-0000-0000-000000000000");
            assert.equal(normalizeUUID("0000000000000000-0000-0000-0000-0000"), "00000000-0000-0000-0000-000000000000");
            assert.equal(normalizeUUID("00000000000000000000000000000000"), "00000000-0000-0000-0000-000000000000");
        },
        "throw if string is not a valid UUIDv4"() {
            assert.throws(() => normalizeUUID(""), `Invalid UUID string ""`);
            assert.throws(() => normalizeUUID("this is not a UUID"), `Invalid UUID string "this is not a UUID"`);
            assert.throws(() => normalizeUUID("00000000-ALEX-0000-0000-000000000000"), `Invalid UUID string "00000000-ALEX-0000-0000-000000000000"`);
        },
    },
});
