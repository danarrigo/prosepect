import { users } from "../schema";
import { db } from "../index";
import { eq } from "drizzle-orm";


//CREATE
export async function createUser(fullName: string, email: string, password: string) {
    const result = await db.insert(users).values({
        fullName,
        email,
        password
    })
    return result;
}



//READ
export async function getUsers() {
    const result = await db.query.users.findMany();
    return result;
}

export async function getUserById(id: string) {
    const result = await db.query.users.findFirst({ where: eq(users.id, id) })
    return result;
}

export async function getUserByEmail(email: string) {
    const result = await db.query.users.findFirst({ where: eq(users.email, email) })
    return result;
}

//UPDATE
export async function updateUser(id: string, fullName: string, email: string, password: string) {
    const result = await db.update(users).set({
        fullName,
        email,
        password
    }).where(eq(users.id, id))

    return result;
}

//DELETE
export async function deleteUser(id: string) {
    const result = await db.delete(users).where(eq(users.id, id))
    return result;
}