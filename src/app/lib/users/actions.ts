"use server"

import { addOTPEntry, getOTPData, validateOTP, deleteOTPEntry, isOTPPending } from "@/app/db/services/otp.service";
import { createUser, getUserByEmail, updateUserHandleAndName, getUserByHandle } from "../../db/queries/users"
import { redirect } from "next/navigation";
import { signIn, auth } from "@/auth";
import { AuthError } from "next-auth";

export async function signUp(formData: FormData): Promise<void> {
    const fullName = formData.get("fullName") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    if (await getUserByEmail(email)) {
        throw new Error("User already exists");
    }
    if (await isOTPPending(email)) {
        redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
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
    
    // Automatically log the user in now that their account is created
    await signIn("credentials", {
        email: userData.email,
        password: userData.password,
        redirectTo: "/curated",
    });
}

export async function login(formData: FormData): Promise<void> {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
        await signIn("credentials", {
            email,
            password,
            redirectTo: "/curated",
        });
    } catch (error) {
        if (error instanceof AuthError) {
            // Check if user was just waiting for OTP instead of failing login
            if (await isOTPPending(email)) {
                redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
            }
            throw new Error("Failed to login: Invalid credentials");
        }
        // Rethrow any other errors (Next.js redirect throws an error internally)
        throw error;
    }
}

export async function completeOnboarding(formData: FormData): Promise<void> {
    const handle = formData.get("handle") as string;
    const name = formData.get("name") as string;
    
    if (!handle || !name) {
        throw new Error("Handle and name are required");
    }
    
    // clean handle (remove @ if they typed it)
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    const session = await auth();
    if (!session?.user?.email) {
        throw new Error("Unauthorized");
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
        throw new Error("User not found");
    }

    // Check if handle is taken
    const existing = await getUserByHandle(cleanHandle);
    if (existing && existing.id !== user.id) {
        throw new Error("Handle is already taken");
    }

    await updateUserHandleAndName(user.id, cleanHandle, name);
    
    redirect("/curated");
}