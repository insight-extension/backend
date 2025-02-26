import { Controller } from '@nestjs/common';
import { DepositProgramService } from './deposit-program.service';

@Controller('deposit-program')
export class DepositProgramController {
  constructor(private readonly depositProgramService: DepositProgramService) {}
}
