import { users, accounts } from "../schema";
import { db } from "../index";
import { eq } from "drizzle-orm";


//CREATE
export async function createUser(fullName: string, email: string, password: string) {
    const result = await db.insert(users).values({
        name: fullName,
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

export async function getUserAccounts(userId: string) {
    const result = await db.query.accounts.findMany({ where: eq(accounts.userId, userId) })
    return result;
}

export async function getUserByHandle(handle: string) {
    const result = await db.select({
        id: users.id,
        handle: users.handle,
        name: users.name,
        image: users.image,
        created_at: users.created_at
    })
    .from(users)
    .where(eq(users.handle, handle));
    
    return result[0];
}

//UPDATE
export async function updateUser(id: string, fullName: string, email: string, password: string) {
    const result = await db.update(users).set({
        name: fullName,
        email,
        password
    }).where(eq(users.id, id))

    return result;
}

export async function updateUserHandleAndName(id: string, handle: string, name: string) {
    const result = await db.update(users).set({
        handle,
        name
    }).where(eq(users.id, id));

    return result;
}


//DELETE
export async function deleteUser(id: string) {
    const result = await db.delete(users).where(eq(users.id, id))
    return result;
}