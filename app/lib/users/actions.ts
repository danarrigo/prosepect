"use server"

import { createUser, getUserByEmail } from "../../db/queries/users"
import { redirect } from "next/navigation";

export async function signUp(formData: FormData): Promise<void> {
    const fullName = formData.get("fullName") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const result = await createUser(fullName, email, password);

    if (result) {
        redirect("/curated");

    } else {
        throw new Error("Failed to create user");
    }
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