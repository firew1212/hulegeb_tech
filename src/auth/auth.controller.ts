import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../authorization/current-user.decorator.js';
import { Public } from '../authorization/roles.decorator.js';
import type { RequestUser } from '../authorization/authorization.constants.js';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  ResendPhoneVerificationDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailDto,
  VerifyPhoneDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register')
  register(@Body() input: RegisterDto) {
    return this.authService.register(input);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() input: LoginDto) {
    return this.authService.login(input.identifier, input.password);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() input: RefreshTokenDto) {
    return this.authService.refresh(input.refreshToken);
  }
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/verify-admin-mfa')
  verifyAdminMfa(@Body() input: VerifyPhoneDto) {
    return this.authService.verifyAdminMfa(input.phone, input.code);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-email')
  verifyEmail(@Body() input: VerifyEmailDto) {
    return this.authService.verifyEmail(input.token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-phone')
  verifyPhone(@Body() input: VerifyPhoneDto) {
    return this.authService.verifyPhone(input.phone, input.code);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @Post('verification/resend')
  resendPhoneVerification(@Body() input: ResendPhoneVerificationDto) {
    return this.authService.resendPhoneVerification(input.phone);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @Post('verification/email/resend')
  resendEmailVerification(@Body() input: ForgotPasswordDto) {
    return this.authService.resendEmailVerification(input.email);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @Post('password/forgot')
  requestPasswordReset(@Body() input: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(input);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('password/reset')
  resetPassword(@Body() input: ResetPasswordDto) {
    return this.authService.resetPassword(input);
  }

  @ApiBearerAuth('bearer')
  @Get('me')
  getProfile(@CurrentUser() user: RequestUser) {
    return this.authService.getProfile(user.id);
  }

  @ApiBearerAuth('bearer')
  @Patch('me')
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Body() input: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, input);
  }

  @ApiBearerAuth('bearer')
  @Post('logout')
  logout(@CurrentUser() user: RequestUser) {
    return this.authService.logout(user);
  }
}
