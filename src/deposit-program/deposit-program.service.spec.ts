import { Test, TestingModule } from '@nestjs/testing';
import { DepositProgramService } from './deposit-program.service';

describe('DepositProgramService', () => {
  let service: DepositProgramService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DepositProgramService],
    }).compile();

    service = module.get<DepositProgramService>(DepositProgramService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
