import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { DepositProgram } from './interfaces/deposit_program';
import { clusterApiUrl, Connection } from '@solana/web3.js';
import { IDL } from '@coral-xyz/anchor/dist/cjs/native/system';
import 'dotenv/config';

@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly provider;
  private readonly connection;
  private readonly program;
  private readonly PROGRAM_ID = process.env.PROGRAM_ID;

  constructor() {
    // Setup config
    this.provider = anchor.AnchorProvider.env();
    anchor.setProvider(this.provider);
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    // this.program = new Program<DepositProgram>(IDL, PROGRAM_ID, {
    //   connection: this.connection,
    // });
  }

  onModuleInit() {
    Logger.log('Payment Service initialized');
  }
}
