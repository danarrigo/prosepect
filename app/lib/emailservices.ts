import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendOTP(email: string, otp: string) {
    const { data, error } = await resend.emails.send({
        from: 'noreply@mail.prosepect.com',
        to: email,
        subject: 'OTP for Prosepect account creation',
        html: `
        <html>
        <body>
            <h1>Welcome to Prosepect</h1>
            <p>Thank you for registering with Prosepect.</p>
            <p>Your OTP is:</p>
            <h2>${otp}</h2>
            <p>This OTP will expire in 5 minutes.</p>
            <p>If you did not create this account, please ignore this email.</p>
            <p>Best regards,</p>
            <p>Prosepect Team</p>
        </body>
        </html>
        `
    });

    if (error) {
        console.error(error.message);
        return false;
    }

    return true;
}