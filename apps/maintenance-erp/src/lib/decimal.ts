/**
 * Arbitrary-Precision Fixed-Point Decimal Arithmetic Helper
 * Prevents IEEE 754 floating-point inaccuracies in financial calculations.
 */

export type DecimalLike = number | string | bigint | Decimal;

export class Decimal {
  private static readonly SCALE = 8;
  private static readonly MULTIPLIER = 100_000_000n; // 10^8

  private readonly value: bigint;

  constructor(val: DecimalLike = 0) {
    if (val instanceof Decimal) {
      this.value = val.value;
    } else if (typeof val === 'bigint') {
      this.value = val * Decimal.MULTIPLIER;
    } else if (typeof val === 'number') {
      if (!Number.isFinite(val)) {
        throw new Error(`Invalid non-finite number: ${val}`);
      }
      this.value = Decimal.fromString(val.toFixed(Decimal.SCALE));
    } else if (typeof val === 'string') {
      this.value = Decimal.fromString(val.trim());
    } else {
      throw new Error(`Unsupported Decimal value: ${val}`);
    }
  }

  private static fromString(str: string): bigint {
    if (!str || str === '' || str === '.') {
      return 0n;
    }
    const isNegative = str.startsWith('-');
    const cleanStr = isNegative ? str.slice(1) : str;

    const parts = cleanStr.split('.');
    const integerPart = parts[0] ? BigInt(parts[0]) : 0n;
    let fractionPartStr = parts[1] || '';

    if (fractionPartStr.length > Decimal.SCALE) {
      fractionPartStr = fractionPartStr.slice(0, Decimal.SCALE);
    } else {
      fractionPartStr = fractionPartStr.padEnd(Decimal.SCALE, '0');
    }

    const fractionPart = BigInt(fractionPartStr);
    const combined = integerPart * Decimal.MULTIPLIER + fractionPart;
    return isNegative ? -combined : combined;
  }

  static fromBigInt(internalValue: bigint): Decimal {
    const d = Object.create(Decimal.prototype);
    Object.defineProperty(d, 'value', { value: internalValue, writable: false });
    return d;
  }

  static zero(): Decimal {
    return new Decimal(0);
  }

  static max(...values: DecimalLike[]): Decimal {
    if (values.length === 0) return Decimal.zero();
    let maxVal = new Decimal(values[0]);
    for (let i = 1; i < values.length; i++) {
      const cur = new Decimal(values[i]);
      if (cur.greaterThan(maxVal)) {
        maxVal = cur;
      }
    }
    return maxVal;
  }

  static min(...values: DecimalLike[]): Decimal {
    if (values.length === 0) return Decimal.zero();
    let minVal = new Decimal(values[0]);
    for (let i = 1; i < values.length; i++) {
      const cur = new Decimal(values[i]);
      if (cur.lessThan(minVal)) {
        minVal = cur;
      }
    }
    return minVal;
  }

  plus(other: DecimalLike): Decimal {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return Decimal.fromBigInt(this.value + o.value);
  }

  minus(other: DecimalLike): Decimal {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return Decimal.fromBigInt(this.value - o.value);
  }

  times(other: DecimalLike): Decimal {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return Decimal.fromBigInt((this.value * o.value) / Decimal.MULTIPLIER);
  }

  dividedBy(other: DecimalLike): Decimal {
    const o = other instanceof Decimal ? other : new Decimal(other);
    if (o.value === 0n) {
      throw new Error('Division by zero');
    }
    return Decimal.fromBigInt((this.value * Decimal.MULTIPLIER) / o.value);
  }

  round(decimals: number = 3): Decimal {
    if (decimals < 0 || decimals > Decimal.SCALE) {
      throw new Error(`Decimals must be between 0 and ${Decimal.SCALE}`);
    }
    const factor = 10n ** BigInt(Decimal.SCALE - decimals);
    const half = factor / 2n;

    const isNeg = this.value < 0n;
    const absVal = isNeg ? -this.value : this.value;

    const rounded = (absVal + half) / factor * factor;
    return Decimal.fromBigInt(isNeg ? -rounded : rounded);
  }

  abs(): Decimal {
    if (this.isNegative()) {
      return Decimal.zero().minus(this);
    }
    return this;
  }

  toDecimalPlaces(decimals: number = 2): Decimal {
    return this.round(decimals);
  }

  isNegative(): boolean {
    return this.value < 0n;
  }

  isZero(): boolean {
    return this.value === 0n;
  }

  greaterThan(other: DecimalLike): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value > o.value;
  }

  greaterThanOrEqualTo(other: DecimalLike): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value >= o.value;
  }

  lessThan(other: DecimalLike): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value < o.value;
  }

  lessThanOrEqualTo(other: DecimalLike): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value <= o.value;
  }

  equals(other: DecimalLike): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value === o.value;
  }

  toNumber(): number {
    return parseFloat(this.toFixed(3));
  }

  toFixed(decimals: number = 3): string {
    const isNeg = this.value < 0n;
    const absVal = isNeg ? -this.value : this.value;

    const integerPart = absVal / Decimal.MULTIPLIER;
    const fractionPart = absVal % Decimal.MULTIPLIER;

    const fractionStr = fractionPart.toString().padStart(Decimal.SCALE, '0');
    const truncatedFraction = fractionStr.slice(0, decimals);

    const sign = isNeg ? '-' : '';
    if (decimals === 0) {
      return `${sign}${integerPart}`;
    }
    return `${sign}${integerPart}.${truncatedFraction}`;
  }

  toString(): string {
    return this.toFixed(3);
  }
}
