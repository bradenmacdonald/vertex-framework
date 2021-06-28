// deno-lint-ignore-file no-explicit-any
/**
 * Helper functions and types for validating typed data.
 * 
 * These are for internal use within Vertex Framework only, and aren't exported as part of the framework code.
 */
import { Neo4j } from "../../deps.ts";
import { VDate } from "./vdate.ts";
import { isVNID, VNID } from "./vnid.ts";

/**
 * A validator is any function that checks a value and returns the "cleaned" value if successful, or throws an exception
 * if unsuccessful. This is nicely compatible with the https://deno.land/x/computed_types library, although Vertex does
 * not directly use that library.
 */
export type Validator<T> = (value: unknown) => T;
export type TypedValidator<T> = (value: T) => T;

/** A VNID Validator */
export const validateVNID: Validator<VNID> = (value) => {
    // An alternative is to use this regex: /^_[0-9A-Za-z]{1,22}$/
    if (!isVNID(value)) {
        throw new Error("Invalid VNID");
    }
    return value;
};

const max64bitInt = 2n**63n - 1n;
const min64bitInt = -(2n**64n - 1n);

/** An boolean validator */
export const validateBoolean: Validator<boolean> = (value) => {
    if (typeof value !== "boolean") {
        throw new Error("Not a boolean");
    }
    return value;
};

/** A BigInt validator. To help with consistency and error checking, this does NOT coerce values to BigInt. */
export const validateBigInt: Validator<bigint> = (value) => {
    if (typeof value === "bigint") {
        // "The Neo4j type system uses 64-bit signed integer values. The range of values is between -(2**64- 1) and
        // (2**63- 1)." So we reject BigInts outside of that range.
        if (value > max64bitInt || value < min64bitInt) {
            throw new Error("BigInt value is outside of Neo4j's supported 64 bit range.");
        }
        return value;  // It's already a BigInt, return it unchanged.
    } else {
        // Note that we don't automatically convert strings or any other data type.
        throw new Error("Not a BigInt value.");
    }
};

/** An integer validator */
export const validateInteger: Validator<number> = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error("Not a number");
    } else if (value != Math.floor(value)) {
        throw new Error("Value is a float, not an integer");
    }
    return value;
};

/** An float validator */
export const validateFloat: Validator<number> = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error("Not a number");
    }
    return value;
};

/** An string validator */
export const validateString: Validator<string> = (value) => {
    if (typeof value !== "string") {
        throw new Error("Not a string");
    }
    return value;
};

/** A default string validator, that trims whitespace from the string and gives it a max length */
export const trimStringMaxLength = (maxLength: number) => (value: unknown) => {
    const newValue = validateString(value).trim();
    if (newValue.length > maxLength) {
        throw new Error(`String value is longer than default length of ${maxLength} characters`);
    }
    return newValue;
};

/** Validate that a value is a VDate (date without time). Also auto-converts from Neo4j Date to VDate. */
export const validateVDate: Validator<VDate> = (value) => {
    if (value instanceof VDate) {
        return value;
    } else if (Neo4j.isDate(value as any)) {
        return VDate.fromNeo4jDate(value as any);
    } else if ((value as any) instanceof Date) {
        throw new Error("Don't use JavaScript Date objects for calendar dates - too many timezone problems. Try VDate.fromString(\"YYYY-MM-DD\") instead.");
    }
    throw new Error("Not a date value.");
};

/** Validate that a value is a JavaScript Date (date with time). Also auto-converts from Neo4j DateTime to Date. */
export const validateDateTime: Validator<Date> = (value) => {
    if (value instanceof Date) {
        return value;
    } else if (Neo4j.isDateTime(value as any)) {
        return new Date((value as any).toString());
    }
    throw new Error("Not a date value.");
};

/** Validator for our AnyPrimitive type. */
export const validateAnyPrimitive: Validator<null|boolean|number|bigint|string|VDate|Date> = (value) => {
    if (
        value === null
        || typeof value === "boolean"
        || typeof value === "number"
        || typeof value === "bigint"
        || typeof value === "string"
        || value instanceof VDate
        || value instanceof Date
    ) {
        return value;
    } else {
        throw new Error(`Value with type ${typeof value} is not a primitive value (not suitable for AnyPrimitive).`);
    }
};

/** Validation regex for Unicode-aware slugs */
const slugRegex = /^[-\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]+$/u;

/**
 * Validate that a string value is a slug. Can contain letters from any language, but not spaces or punctuation other
 * than hyphen (hyphen is allowed, but underscore is not as underscore is less visible when text is underlined).
 */
export const validateSlug: Validator<string> = (_value) => {
    const value = validateString(_value);
    if (!slugRegex.test(value)) {
        throw new Error(`Not a valid slug (cannot contain spaces or other special characters other than '-')`);
    }
    return value;
}

const emailTester = /^[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;

function isEmail(email: string): boolean {
    // Email validation code is from https://github.com/manishsaraan/email-validator (public domain)
    const emailParts = email.split('@');

    if(emailParts.length !== 2) {
        return false;
    }

    const account = emailParts[0];
    const address = emailParts[1];

    if (account.length > 64) {
        return false;
    } else if(address.length > 255) {
        return false;
    }

    const domainParts = address.split('.');
    if (domainParts.some((part) => part.length > 63)) {
        return false;
    }

    if (!emailTester.test(email)) {
        return false;
    }

    return true;
}

export const validateEmail: Validator<string> = (_value) => {
    const value = validateString(_value);
    if (!isEmail(value)) {
        throw new Error(`"${value}" is not a valid email address.`);
    }
    return value;
}
