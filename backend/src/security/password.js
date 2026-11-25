import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

// A precomputed hash used when the account doesn't exist, so login
// takes the same time whether or not the email is registered.
const DUMMY_HASH = bcrypt.hashSync("shopmind-timing-equalizer", BCRYPT_ROUNDS);

const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "iloveyou", "admin123", "welcome1", "shopmind", "letmein123",
]);

/**
 * Returns an error message, or null if the password is acceptable.
 */
export const passwordProblem = (password) => {
  if (typeof password !== "string") return "Password is required";
  if (password.length < 10) return "Password must be at least 10 characters";
  if (password.length > 128) return "Password must be at most 128 characters";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password must include at least one letter and one number";
  }
  if (COMMON.has(password.toLowerCase())) return "That password is too common";
  return null;
};

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

export const verifyPassword = async (password, hash) => {
  if (typeof password !== "string" || password.length > 128) {
    await bcrypt.compare("x", DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash || DUMMY_HASH).then((ok) => ok && Boolean(hash));
};
