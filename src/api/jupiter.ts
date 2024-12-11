import { DCA, Network } from '@jup-ag/dca-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import type { TokenSummary, Position, ChartDataPoint } from '../types/dca';

const LOGOS_MINT = 'HJUfqXoYjC653f2p33i84zdCC3jc4EuVnbruSe5kpump';
const CHAOS_MINT = '8SgNwESovnbG1oNEaPVhg6CR9mTMSK7jPvcYRe3wpump';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

interface DCAAccountType {
  publicKey: PublicKey;
  account: {
    user: PublicKey;
    inputMint: PublicKey;
    outputMint: PublicKey;
    idx: BN;
    nextCycleAt: BN;
    inDeposited: BN;
    inWithdrawn: BN;
    outWithdrawn: BN;
    inUsed: BN;
    inAmountPerCycle: BN;
    cycleFrequency: BN;
    bump: number;
    minOutAmount?: BN;
    maxOutAmount?: BN;
  };
}

class JupiterDCAAPI {
  private dca!: DCA;
  private jupiterApiUrl = 'https://price.jup.ag/v4';

  constructor() {
    const connection = new Connection(import.meta.env.VITE_HELIUS_RPC_URL);
    this.dca = new DCA(connection, Network.MAINNET);
  }

  private async getCurrentPrice(mint: string): Promise<{ price: number; mint: string }> {
    try {
      const response = await fetch(
        `${this.jupiterApiUrl}/price?ids=${mint}&vsToken=${USDC_MINT}`
      );
      const data = await response.json();
      return {
        price: data.data?.[mint]?.price || 0,
        mint
      };
    } catch (error) {
      console.error('Error fetching price:', error);
      return { price: 0, mint };
    }
  }

  // Convert SDK account format to our Position type
  private convertDCAAccount(account: DCAAccountType, price: number, token: string, type: "BUY" | "SELL"): Position {
    console.log('Converting account:', {
      inputMint: account.account.inputMint.toString(),
      outputMint: account.account.outputMint.toString()
    });

    return {
      id: account.publicKey.toString(),
      token,
      type,
      inputToken: type === "BUY" ? "USDC" : token,
      outputToken: type === "BUY" ? token : "USDC",
      inputAmount: account.account.inAmountPerCycle.toNumber() / Math.pow(10, 6),
      totalAmount: account.account.inDeposited.sub(account.account.inWithdrawn).toNumber() / Math.pow(10, 6),
      amountPerCycle: account.account.inAmountPerCycle.toNumber() / Math.pow(10, 6),
      remainingCycles: account.account.cycleFrequency.toNumber(),
      cycleFrequency: account.account.cycleFrequency.toNumber(),
      lastUpdate: account.account.nextCycleAt.toNumber() * 1000,
      publicKey: account.publicKey.toString(),
      targetPrice: (account.account.minOutAmount?.toNumber() || 0) / Math.pow(10, 6),
      currentPrice: price,
      priceToken: "USDC",
      estimatedOutput: account.account.minOutAmount?.toNumber() ? 
        (account.account.inAmountPerCycle.toNumber() / account.account.minOutAmount.toNumber()) : undefined
    };
  }

  async getDCAAccounts(): Promise<{
    positions: Position[],
    summary: Record<string, TokenSummary>,
    chartData: Record<string, ChartDataPoint[]>
  }> {
    try {
      if (!this.dca) {
        throw new Error('DCA SDK not initialized');
      }

      // 1. Get all accounts first
      const allAccounts = await this.dca.getAll();
      console.log('Total accounts fetched:', allAccounts.length);

      // After getting allAccounts
      console.log('Account details:', allAccounts.map(acc => ({
        input: acc.account.inputMint.toString(),
        output: acc.account.outputMint.toString(),
        isLogosInput: acc.account.inputMint.equals(new PublicKey(LOGOS_MINT)),
        isLogosOutput: acc.account.outputMint.equals(new PublicKey(LOGOS_MINT))
      })));

      // 2. Initial categorization
      const accountsByToken = {
        LOGOS: {
          buys: allAccounts.filter(acc => acc.account.outputMint.equals(new PublicKey(LOGOS_MINT))),
          sells: allAccounts.filter(acc => acc.account.inputMint.equals(new PublicKey(LOGOS_MINT)))
        },
        CHAOS: {
          buys: allAccounts.filter(acc => acc.account.outputMint.equals(new PublicKey(CHAOS_MINT))),
          sells: allAccounts.filter(acc => acc.account.inputMint.equals(new PublicKey(CHAOS_MINT)))
        }
      };

      // After categorization
      console.log('LOGOS Accounts:', {
        buys: accountsByToken.LOGOS.buys.map(acc => ({
          input: acc.account.inputMint.toString(),
          output: acc.account.outputMint.toString()
        })),
        sells: accountsByToken.LOGOS.sells.map(acc => ({
          input: acc.account.inputMint.toString(),
          output: acc.account.outputMint.toString()
        }))
      });

      console.log('Accounts by token:', {
        LOGOS: {
          buys: accountsByToken.LOGOS.buys.length,
          sells: accountsByToken.LOGOS.sells.length
        },
        CHAOS: {
          buys: accountsByToken.CHAOS.buys.length,
          sells: accountsByToken.CHAOS.sells.length
        }
      });

      // 3. Calculate summary first
      const summary = this.calculateSummaryFromRawAccounts(accountsByToken);
      console.log('Summary calculated:', summary);

      // 4. Then process individual positions
      const positions = [
        ...accountsByToken.LOGOS.buys.map(acc => this.convertDCAAccount(acc, 0, "LOGOS", "BUY")),
        ...accountsByToken.LOGOS.sells.map(acc => this.convertDCAAccount(acc, 0, "LOGOS", "SELL")),
        ...accountsByToken.CHAOS.buys.map(acc => this.convertDCAAccount(acc, 0, "CHAOS", "BUY")),
        ...accountsByToken.CHAOS.sells.map(acc => this.convertDCAAccount(acc, 0, "CHAOS", "SELL"))
      ];

      // 5. Update prices and positions
      const [logosPrice, chaosPrice] = await Promise.all([
        this.getCurrentPrice(LOGOS_MINT),
        this.getCurrentPrice(CHAOS_MINT)
      ]);

      const positionsWithPrices = positions.map(pos => ({
        ...pos,
        currentPrice: pos.token === 'LOGOS' ? logosPrice.price : chaosPrice.price
      }));

      // Add the return statement
      const chartData = {
        LOGOS: [{
          timestamp: Date.now(),
          buyVolume: summary.LOGOS.buyVolume,
          sellVolume: summary.LOGOS.sellVolume,
          buyOrders: summary.LOGOS.buyOrders,
          sellOrders: summary.LOGOS.sellOrders
        }],
        CHAOS: [{
          timestamp: Date.now(),
          buyVolume: summary.CHAOS.buyVolume,
          sellVolume: summary.CHAOS.sellVolume,
          buyOrders: summary.CHAOS.buyOrders,
          sellOrders: summary.CHAOS.sellOrders
        }]
      };

      return { 
        positions: positionsWithPrices, 
        summary, 
        chartData 
      };
    } catch (error) {
      console.error('Error fetching DCA accounts:', error);
      throw error;
    }
  }

  private calculateSummaryFromRawAccounts(accountsByToken: {
    LOGOS: { buys: DCAAccountType[], sells: DCAAccountType[] },
    CHAOS: { buys: DCAAccountType[], sells: DCAAccountType[] }
  }): Record<string, TokenSummary> {
    const summary: Record<string, TokenSummary> = {
      LOGOS: {
        buyOrders: accountsByToken.LOGOS.buys.length,
        sellOrders: accountsByToken.LOGOS.sells.length,
        buyVolume: accountsByToken.LOGOS.buys.reduce((sum, acc) => 
          sum + acc.account.inDeposited.sub(acc.account.inWithdrawn).toNumber() / Math.pow(10, 6), 0),
        sellVolume: accountsByToken.LOGOS.sells.reduce((sum, acc) => 
          sum + acc.account.inDeposited.sub(acc.account.inWithdrawn).toNumber() / Math.pow(10, 6), 0),
        buyVolumeUSDC: accountsByToken.LOGOS.buys.reduce((sum, acc) => 
          sum + acc.account.inAmountPerCycle.toNumber() / Math.pow(10, 6), 0),
        sellVolumeUSDC: accountsByToken.LOGOS.sells.reduce((sum, acc) => 
          sum + acc.account.inAmountPerCycle.toNumber() / Math.pow(10, 6), 0)
      },
      CHAOS: {
        buyOrders: accountsByToken.CHAOS.buys.length,
        sellOrders: accountsByToken.CHAOS.sells.length,
        buyVolume: accountsByToken.CHAOS.buys.reduce((sum, acc) => 
          sum + acc.account.inDeposited.sub(acc.account.inWithdrawn).toNumber() / Math.pow(10, 6), 0),
        sellVolume: accountsByToken.CHAOS.sells.reduce((sum, acc) => 
          sum + acc.account.inDeposited.sub(acc.account.inWithdrawn).toNumber() / Math.pow(10, 6), 0),
        buyVolumeUSDC: accountsByToken.CHAOS.buys.reduce((sum, acc) => 
          sum + acc.account.inAmountPerCycle.toNumber() / Math.pow(10, 6), 0),
        sellVolumeUSDC: accountsByToken.CHAOS.sells.reduce((sum, acc) => 
          sum + acc.account.inAmountPerCycle.toNumber() / Math.pow(10, 6), 0)
      }
    };

    return summary;
  }

  // ... rest of the code
}

export const jupiterDCA = new JupiterDCAAPI(); 