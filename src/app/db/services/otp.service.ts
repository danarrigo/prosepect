import { redis } from "../redis";
import { generateOTP, createOTPHash } from "@/app/lib/utils";
import { sendOTP } from "@/app/lib/emailservices"

export async function addOTPEntry(fullName: string, email: string, password: string) {
    if (await redis.exists(`signup:otp:${email}`)) {
        return false;
    }
    if (await redis.exists(`login:data:${email}`)) {
        return false;
    }
    const OTPVal = generateOTP();
    const OTPHash = createOTPHash(OTPVal);

    // Combine set and expire for efficiency
    await redis.set(`signup:otp:${email}`, OTPHash, { ex: 60 * 5 });
    await redis.set(`signup:data:${email}`, { fullName, email, password }, { ex: 60 * 5 });

    await sendOTP(email, OTPVal);
    return true;
}

export async function isOTPPending(email: string): Promise<boolean> {
    return await redis.exists(`signup:otp:${email}`) !== 0;
}

export async function getOTPData(email: string): Promise<{ fullName: string, email: string, password: string } | null> {
    const result = await redis.get<{ fullName: string, email: string, password: string }>(`signup:data:${email}`);
    return result;
}

export async function validateOTP(otp: string, email: string): Promise<boolean> {
    const val = await redis.get(`signup:otp:${email}`);
    if (!val) {
        console.log("OTP has expired");
        return false;
    }
    const hashedOTP = createOTPHash(otp);
    if (hashedOTP != val) {
        console.log("invalid OTP");
        return false;
    }
    return true;
}

export async function deleteOTPEntry(email: string) {
    await redis.del(`signup:otp:${email}`);
    await redis.del(`signup:data:${email}`);
}