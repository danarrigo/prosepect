"use server"

import { addOTPEntry, getOTPData, validateOTP, deleteOTPEntry } from "@/app/db/services/otp.service";
import { createUser, getUserByEmail } from "../../db/queries/users"
import { redirect } from "next/navigation";

export async function signUp(formData: FormData): Promise<void> {
    const fullName = formData.get("fullName") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    if (await getUserByEmail(email)) {
        throw new Error("User already exists");
    }
    await addOTPEntry(fullName, email, password);
    redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
}

export async function signUpValidation(formData: FormData): Promise<void> {
    const otp = formData.get("otp") as string;
    const email = formData.get("email") as string;
    
    if (!await validateOTP(otp, email)) {
        throw new Error("Invalid OTP");
    }
    
    const userData = await getOTPData(email);
    if (!userData) {
        throw new Error("OTP has expired");
    }
    
    await createUser(userData.fullName, userData.email, userData.password);
    await deleteOTPEntry(email);
    redirect("/curated");
}

export async function login(formData: FormData): Promise<void> {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const existingUser = await getUserByEmail(email);
    if (existingUser && existingUser.password == password) {
        redirect("/curated");
    } else {
        throw new Error("Failed to login");
    }
}