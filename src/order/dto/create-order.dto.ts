import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
