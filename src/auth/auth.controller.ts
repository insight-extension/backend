import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { VerifyDto } from './dto/verify.dto';
import { Login } from './interfaces/login.interface';
import { Verify } from './interfaces/verify.interface';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ClaimDto } from './dto/claim.dto';
import 'dotenv/config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiResponse({
    status: 201,
    description:
      'Generates a nonce for the given public key to proceed with the login flow.',
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('claim')
  async claim(@Body(new ValidationPipe()) dto: ClaimDto): Promise<Login> {
    return this.authService.claim(dto);
  }

  @ApiResponse({
    status: 201,
    description:
      'Verifies the provided signature and returns access and refresh tokens. If the account does not exist, it will be created.',
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('verify')
  async verify(@Body(new ValidationPipe()) dto: VerifyDto): Promise<Verify> {
    return this.authService.verify(dto);
  }

  @ApiResponse({
    status: 201,
    description:
      'Generates a new access and refresh token for the given public key.',
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('refresh-token')
  async refreshToken(
    @Body(new ValidationPipe()) dto: RefreshTokenDto,
  ): Promise<Verify> {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @ApiResponse({
    status: 200,
    description: 'Test endpoint. Returns foo. Requires authentication.',
  })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Get('foo')
  async foo() {
    return 'foo';
  }
}
