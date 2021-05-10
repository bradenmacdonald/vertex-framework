import { suite, test, assert } from "../lib/intern-tests";
import { VDate, Neo4jDate } from "./vdate";

suite(__filename, () => {

    suite("VDate", () => {
        test("fromString() can parse the compact ISO 8601 representation", () => {
            assert.equal(VDate.fromString("20300102").toString(), "2030-01-02");
        });

        test("fromString() and toString() round trips work", () => {
            const check = (dateString: string): void => assert.strictEqual(VDate.fromString(dateString).toString(), dateString);
            check("1920-01-02");
            check("2015-10-05");
        });

        test("Rejects invalid dates and understands leap years", () => {
            const check = (goodDate: string, badDate: string): void => {
                assert.strictEqual(VDate.fromString(goodDate).toString(), goodDate);
                assert.throws(() => { VDate.fromString(badDate); });
            };
            // The following pairs have one date that is a valid date at the end of a month, and one the subsequent
            // "bad date" which is invalid. The first of each pair should parse and the second should throw an error.
            check("1900-02-28", "1900-02-29");
            check("1950-01-31", "1950-01-32");
            check("1950-02-28", "1950-02-29");
            check("1950-03-31", "1950-03-32");
            check("1950-04-30", "1950-04-31");
            check("1950-05-31", "1950-05-32");
            check("1950-06-30", "1950-06-31");
            check("1950-07-31", "1950-07-32");
            check("1950-08-31", "1950-08-32");
            check("1950-09-30", "1950-09-31");
            check("1950-10-31", "1950-10-32");
            check("1950-11-30", "1950-11-31");
            check("1950-12-31", "1950-12-32");
            check("1952-02-29", "1952-02-30");
            check("2000-02-29", "2000-02-30");
            check("2020-02-29", "2020-02-30");
        });

        test("rejects invalid date strings", () => {
            assert.throws(() => { VDate.fromString("foobar"); });
            assert.throws(() => { VDate.fromString("2020-15-15"); });
            assert.throws(() => { VDate.fromString("2020-MM-DD"); });
        });

        test("Converts to JSON as an ISO 8601 string", () => {
            assert.strictEqual(
                JSON.stringify({someKey: [new VDate(2010, 5, 15)]}),
                JSON.stringify({someKey: ["2010-05-15"]}),
            );
        });

        test("Neo4jDate can be converted to VDate", () => {
            const neoDate = new Neo4jDate(2010, 5, 15);
            assert.strictEqual(
                VDate.fromNeo4jDate(neoDate).toString(),
                neoDate.toString(),
            );
        });

    });
});
