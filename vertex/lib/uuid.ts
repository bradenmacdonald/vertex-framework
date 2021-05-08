import { randomFillSync } from "crypto";
import { NominalType } from "./ts-utils";

const inspect = Symbol.for("nodejs.util.inspect.custom");

/**
 * A simple TypeScript UUIDv4 implementation for NodeJS
 *
 * Can parse any UUID version, including the nil UUID, but only generates new v4 UUIDs.
 *
 * This class is memory-efficient and stores its value as a Uint8Array. For general
 * purpose use and interopability, you probably want to use the UUID() function below
 * instead.
 */
export class UUIDv4 {
    /** The internal UUID value (16 bytes, 128 bits) */
    private _value: Uint8Array;
    static readonly VERSION = 4;
    static readonly VARIANT = 0b10; // Two bits to specify "Variant 1", a standard UUID

    constructor(stringValue?: string) {
        this._value = new Uint8Array(16);
        if (stringValue !== undefined) {
            const hexDigits = stringValue.replace(/-/g, "");
            if (hexDigits.length !== 32) {
                throw new Error(`Invalid UUID string "${stringValue}"`);
            }
            for (let i = 0; i < 16; i++) {
                // Parsing each digit separately gives more robust error handling; otherwise errors in second digit get ignored.
                const value = parseInt(hexDigits.charAt(i * 2), 16) * 16 + parseInt(hexDigits.charAt(i * 2 + 1), 16);
                if (isNaN(value)) { throw new Error(`Invalid UUID string "${stringValue}"`); }
                // We need to check NaN before storing into this._value, or NaN gets silently converted to 0
                this._value[i] = value;
            }
        } else {
            // Generate a new random UUIDv4:
            randomFillSync(this._value);
            this._value[6] = (this._value[6] & 0x0f) | (UUIDv4.VERSION<<4);
            this._value[8] = (this._value[8] & 0xbf) | (UUIDv4.VARIANT<<6);
        }
    }

    /**
     * Get the UUID as a string (e.g. "d2b92497-d35f-44ff-aa5d-33412ba5c95b")
     */
    public toString(): UUID {
        return this._value.reduce(
            (str, byte, idx) => {
                const includeHyphen: boolean = (!(idx&1) && idx > 3 && idx < 11);
                return str + (includeHyphen ? "-" : "") + byte.toString(16).padStart(2, "0");
            }, ""
        ) as UUID;
    }

    /**
     * Custom JSON serialization
     */
    public toJSON(): string { return this.toString(); }

    /**
     * Get the primitive value (enables correct sorting)
     * Except note that equality checking won't work.
     */
    public valueOf(): string { return this.toString(); }

    /** 
     * Get this UUID as a BigInt
     */
    public toBigInt(): bigint {
        return BigInt(this._value.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "0x"));
        /* This is possibly slightly more efficient, but more complex:
        return (
            (BigInt(this._value[15] + (this._value[14] << 8))) + 
            (BigInt(this._value[13] + (this._value[12] << 8)) << 16n) +
            (BigInt(this._value[11] + (this._value[10] << 8)) << 32n) +
            (BigInt(this._value[ 9] + (this._value[ 8] << 8)) << 48n) +
            (BigInt(this._value[ 7] + (this._value[ 6] << 8)) << 64n) +
            (BigInt(this._value[ 5] + (this._value[ 4] << 8)) << 80n) +
            (BigInt(this._value[ 3] + (this._value[ 2] << 8)) << 96n) +
            (BigInt(this._value[ 1] + (this._value[ 0] << 8)) << 112n)
        );
        */
    }

    /* istanbul ignore next */
    /** Customize display of UUIDs in NodeJS REPL */
    [inspect](depth: any, options: any): string {
        return options.stylize(this.toString(), "special");
    }
}

/** A UUID-string, which is kind of like a subclass of string */
export type UUID = NominalType<string, "UUID">;

/**
 * Generate a new UUIDv4 as a UUID-string, or normalize/validate a UUID and convert it into standard form (lowercase,
 * with hyphens) as a UUID-string. Throw an error if a string is given that is not a valid UUID.
 */
export function UUID(uuidStr?: string): UUID {
    return new UUIDv4(uuidStr).toString();
}
