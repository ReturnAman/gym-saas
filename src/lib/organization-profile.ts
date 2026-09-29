/**
 * Gym profile validation — pure, no server dependencies.
 *
 * This module is intentionally free of `server-only` and database imports
 * so that client components (e.g. the settings form, which needs the
 * max-length constants) can import it. Authorization and persistence live
 * in `@/lib/server/organizations`, which re-exports this module's API.
 */

export const MAX_ORGANIZATION_NAME_LENGTH = 120;
export const MAX_ORGANIZATION_PHONE_LENGTH = 20;
export const MAX_ORGANIZATION_EMAIL_LENGTH = 254;
export const MAX_ORGANIZATION_ADDRESS_LENGTH = 500;

// Permissive on purpose: digits, spaces and common phone punctuation.
// Indian-specific validation is explicitly out of scope for now.
const PHONE_PATTERN = /^[+\d][\d\s\-().]*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fields the client is allowed to submit for the gym profile. */
export interface OrganizationProfileInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

/** Validated profile data — the only shape written to the database. */
export interface OrganizationProfileData {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export type OrganizationProfileField = keyof OrganizationProfileData;

/** Thrown when profile input fails server-side validation. */
export class OrganizationProfileValidationError extends Error {
  errors: Partial<Record<OrganizationProfileField, string>>;

  constructor(errors: Partial<Record<OrganizationProfileField, string>>) {
    super("The gym profile has invalid fields.");
    this.name = "OrganizationProfileValidationError";
    this.errors = errors;
  }
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validate gym profile input server-side. Phone/email/address are optional
 * (nullable in the schema); when provided they must be well-formed.
 * Never throws for missing optional fields.
 */
export function validateOrganizationProfile(
  input: OrganizationProfileInput,
): OrganizationProfileData {
  const errors: Partial<Record<OrganizationProfileField, string>> = {};

  const name = input.name.trim();
  if (!name) {
    errors.name = "Gym name is required.";
  } else if (name.length > MAX_ORGANIZATION_NAME_LENGTH) {
    errors.name = `Gym name must be at most ${MAX_ORGANIZATION_NAME_LENGTH} characters.`;
  }

  const phone = optionalText(input.phone);
  if (phone !== null) {
    if (phone.length > MAX_ORGANIZATION_PHONE_LENGTH) {
      errors.phone = `Phone must be at most ${MAX_ORGANIZATION_PHONE_LENGTH} characters.`;
    } else if (!PHONE_PATTERN.test(phone)) {
      errors.phone = "Enter a valid phone number.";
    }
  }

  const email = optionalText(input.email);
  if (email !== null) {
    if (email.length > MAX_ORGANIZATION_EMAIL_LENGTH) {
      errors.email = `Email must be at most ${MAX_ORGANIZATION_EMAIL_LENGTH} characters.`;
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.email = "Enter a valid email address.";
    }
  }

  const address = optionalText(input.address);
  if (address !== null && address.length > MAX_ORGANIZATION_ADDRESS_LENGTH) {
    errors.address = `Address must be at most ${MAX_ORGANIZATION_ADDRESS_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    throw new OrganizationProfileValidationError(errors);
  }

  return { name, phone, email, address };
}
