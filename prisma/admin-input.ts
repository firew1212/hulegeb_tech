import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { isEmail } from 'class-validator';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { AdminProvisioningError } from './admin-errors.js';

export interface AdminProvisioningInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

export function validateAdminInput(
  input: AdminProvisioningInput,
): AdminProvisioningInput {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = parsePhoneNumberFromString(input.phone, 'ET');

  if (!firstName || firstName.length > 80 || !/\S/.test(firstName)) {
    throw new AdminProvisioningError(
      'First name is required and must be at most 80 characters.',
    );
  }
  if (!lastName || lastName.length > 80 || !/\S/.test(lastName)) {
    throw new AdminProvisioningError(
      'Last name is required and must be at most 80 characters.',
    );
  }
  if (email.length > 254 || !isEmail(email)) {
    throw new AdminProvisioningError('A valid email address is required.');
  }
  if (!phone?.isValid()) {
    throw new AdminProvisioningError(
      'A valid Ethiopian phone number is required.',
    );
  }
  if (
    input.password.length < 12 ||
    input.password.length > 128 ||
    Buffer.byteLength(input.password, 'utf8') > 72
  ) {
    throw new AdminProvisioningError(
      'Password must be 12-128 characters and no more than 72 UTF-8 bytes.',
    );
  }

  return {
    firstName,
    lastName,
    email,
    phone: phone.number,
    password: input.password,
  };
}

async function promptText(question: string): Promise<string> {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

async function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new AdminProvisioningError(
      'Admin provisioning requires an interactive local terminal.',
    );
  }

  stdout.write(question);
  stdin.setEncoding('utf8');
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';

    const restore = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
    };

    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          restore();
          reject(
            new AdminProvisioningError(
              'Admin provisioning input was cancelled.',
            ),
          );
          return;
        }
        if (character === '\r' || character === '\n') {
          restore();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    stdin.on('data', onData);
  });
}

export async function promptForAdminInput(): Promise<AdminProvisioningInput> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new AdminProvisioningError(
      'Admin provisioning requires an interactive local terminal.',
    );
  }

  const firstName = await promptText('Admin first name: ');
  const lastName = await promptText('Admin last name: ');
  const email = await promptText('Admin email: ');
  const phone = await promptText('Admin phone (Ethiopia): ');
  const password = await promptHidden('Admin password (input hidden): ');
  const confirmation = await promptHidden('Confirm admin password: ');

  if (password !== confirmation) {
    throw new AdminProvisioningError('The password entries do not match.');
  }

  return validateAdminInput({ firstName, lastName, email, phone, password });
}

export async function confirmProductionDatabaseTarget(
  target: URL,
): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new AdminProvisioningError(
      'Production admin provisioning requires an interactive local terminal.',
    );
  }

  const databaseName = decodeURIComponent(
    target.pathname.replace(/^\/+/, ''),
  );
  const targetDescription = `PRODUCTION DATABASE ${databaseName} at ${target.hostname}:${target.port || '5432'}`;
  const confirmation = await promptText(
    `Type "${targetDescription}" to continue: `,
  );

  if (confirmation.trim() !== targetDescription) {
    throw new AdminProvisioningError(
      'Production database target confirmation did not match.',
    );
  }
}
