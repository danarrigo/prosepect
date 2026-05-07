import { randomInt, createHash } from "crypto";

export function generateOTP() {
    const minVal = 10 ** 5;
    const maxVal = 10 ** 6;
    const value = randomInt(minVal, maxVal);

    return value.toString();
}

export function createOTPHash(value: string) {
    return createHash("sha256").update(value).digest("hex");
}