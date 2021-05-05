import { NominalType } from "./ts-utils";
import { UUIDv4 } from "./uuid";

/** A UUID-string, which is kind of like a subclass of string */
export type VNID = NominalType<string, "VNID">;

/**
 * Generate a new VNID string, or validate a VNID string
 */
export function VNID(encodedString?: string): VNID {
    if (encodedString === undefined) {
        // Generate a new VNID.
        return encodeVNID(new UUIDv4())
    } else {
        // Validate that an arbitrary string is a VNID (type safety check)
        decodeVNID(encodedString as VNID); // This will raise an exception if the value is not a valid VNID
        return encodedString as VNID;
    }
}

/** Is the given value a VNID string? */
export function isVNID(value: any): value is VNID {
    try {
        decodeVNID(value);
        return true;
    } catch {
        return false;
    }
}

/**
 * Framework-internal helper function that's like "isVNID" but faster and less accurate.
 * This returns true if a string looks like a properly formatted VNID, but doesn't validate that the characters are
 * in allowed ranges or that it can parse to an actual UUID.
 */
export function looksLikeVNID(value: string): value is VNID {
    return value.length >= 2 && value.length <= 23 && value.charAt(0) === "_";
}

/** Helper function: encode a UUID into VNID format (base 62 with underscore prefix) */
function encodeVNID(value: UUIDv4): VNID {
    return "_" + toBase62(value.toBigInt()) as VNID;
}


// Character set for VNIDs - this is base62, in ASCII sort order
const vnidCharset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const base = 62n;

/** Helper function: encode a number in base 62 */
function toBase62(number: bigint): string {
    if (number == 0n) {
        return "0";
    } else if (number < 0n) {
        throw new Error("Cannot convert negative numbers to base 62");
    }
    let encoded = "";
    while (number > 0n) {
        const remainder = Number(number % base);
        number /= base;
        encoded = vnidCharset.charAt(remainder) + encoded;
    }
    return encoded;
}

/**
 * Given a VNID string (base 62 encoded UUID with "_" prefix), decode it to a UUID.
 * 
 * Use decodeVNID(VNID(foo)) to parse a string value; do not use decodeVNID(foo as VNID)
 */
function decodeVNID(value: VNID): UUIDv4 {
    if (typeof value !== "string" || value[0] !== "_") {
        throw new TypeError(`Not a VNID (got: ${value} - a ${typeof value})`);
    }

    let decoded = 0n;
    for (let i = 1; i < value.length; i++) {
        const charValue = vnidCharset.indexOf(value.charAt(i));
        if (charValue === -1) {
            throw new Error(`Invalid character in VNID value (${value.charAt(i)}).`);
        }
        decoded = (decoded * base) + BigInt(charValue);
    }
    return new UUIDv4(decoded.toString(16).padStart(32, "0"));
}

export const testExports = {
    toBase62,
    encodeVNID,
    decodeVNID,
};
