import { group, test, assert, assertEquals } from "../tests.ts";
import { UUIDv4 } from "./uuid.ts";
import { VNID, isVNID, testExports } from "./vnid.ts";
const {toBase62, decodeVNID, encodeVNID} = testExports;


group(import.meta, () => {

    group("VNID", () => {

        test("Creates unique VNIDs", () => {
            const hundredVnidStrings = Array.from({length:100},() => VNID());
            const stringSet = new Set(hundredVnidStrings);
            assertEquals(stringSet.size, 100);
        });

        test("VNIDs match expected patterns", () => {
            for (let i = 0; i < 100; i++) {
                const vnid = VNID();
                assert(typeof vnid, "string");
                assertEquals(vnid.charAt(0), "_");  // VNIDs always start with an underscore.
                // VNIDs use a variable-length encoding, between 2 to 23 characters,
                // though in practice most will be 20-23 characters.
                assert(vnid.length >= 2);
                assert(vnid.length <= 23);
            }
        });
    });

    group("isVNID", () => {
        
        test("Recognizes things that are not VNIDs", () => {
            for (const value of [
                undefined,
                null,
                true,
                "",
                "6996ddbf-6cd0-4541-9ee9-3c37f8028941",
                {},
                "???",
                "c0ffee",
                "0",
                "3DF8hceEobPFSS26FKl733",
            ]) {
                assert(!isVNID(value));
            }
        });
        
        test("Recognizes things that are VNIDs", () => {
            for (const value of [
                // Note that VNIDs are variable length.
                "_XtzOcazuJbitHvhviKM",
                "_RXkbzqSC75IaxkLYpYMo",
                "_VuIbH1qBVKPl61pzwd1wL",
                "_3DF8hceEobPFSS26FKl733",
                "_52DMYoaBc3fGp528wZJSFS",
                "_1JmPKfRIYBkW89LtY492yT", // Note that this is the maximum string length of a VNID
            ]) {
                assert(isVNID(value), `"${value}" should be recognized as a valid VNID`);
            }
        });
        
        test("Recognizes null VNID as a VNID", () => {
            assert(isVNID("_0"));
        });
    });

    // Unit tests of the internal helper methods used to implement VNIDs:

    group("toBase62", () => {

        test("Converts to base 62", () => {
            const pairs: [bigint, string][] = [
                [0n, "0"],
                [9n, "9"],
                [10n, "A"],
                [61n, "z"],
                [62n, "10"],
                [62n * 62n + 10n, "10A"],
            ];
            for (const [value, expected] of pairs) {
                assertEquals(toBase62(value), expected);
            }
        });
    });

    group("encodeVNID/decodeVNID", () => {

        test("Smallest possible VNID", () => {
            const nil = new UUIDv4("00000000-0000-0000-0000-000000000000");
            const vnid = encodeVNID(nil);
            assertEquals(vnid, "_0");
        });

        test("Largest possible VNID", () => {
            const max = new UUIDv4("ffffffff-ffff-ffff-ffff-ffffffffffff");
            const vnid = encodeVNID(max);
            assertEquals(vnid, "_7n42DGM5Tflk9n8mt7Fhc7");
        });

        test("Can convert to VNID and back", () => {
            const uuid = new UUIDv4("6996ddbf-6cd0-4541-9ee9-3c37f8028941");
            const vnid = encodeVNID(uuid);
            assertEquals(vnid, "_3DF8hceEobPFSS26FKl733");
            assertEquals(uuid.toString(), decodeVNID(vnid).toString());
        });

        test("Can convert to VNID and back with leading zeroes", () => {
            const uuid = new UUIDv4("00000dbf-6cd0-4541-9ee9-3c37f8028941");
            const vnid = encodeVNID(uuid);
            assertEquals(vnid, "_1WL2DH88t15G7dcyMhV");
            assertEquals(uuid.toString(), decodeVNID(vnid).toString());
        });
    });
});
