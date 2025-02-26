import { Test, TestingModule } from '@nestjs/testing';
import { DepositProgramController } from './deposit-program.controller';
import { DepositProgramService } from './deposit-program.service';

describe('DepositProgramController', () => {
  let controller: DepositProgramController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepositProgramController],
      providers: [DepositProgramService],
    }).compile();

    controller = module.get<DepositProgramController>(DepositProgramController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
