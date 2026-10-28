import {
  IsEmail,
  Equals,
  IsNotEmpty,
  IsPhoneNumber,
  Matches,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsPhoneNumber('ET')
  phone!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(80)
  lastName!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(40)
  termsVersion!: string;

  @Equals(true)
  acceptedTerms!: boolean;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;
}

export class VerifyPhoneDto {
  @IsPhoneNumber('ET')
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ResendPhoneVerificationDto {
  @IsPhoneNumber('ET')
  phone!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken!: string;
}

export class UpdateProfileDto {
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(80)
  lastName!: string;
}
