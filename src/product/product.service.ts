import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async create(createProductDto: CreateProductDto) {
    const { name, description, price, initialStock } = createProductDto;

    // 1. Lưu thông tin sản phẩm và kho vào PostgreSQL
    const product = await this.prisma.product.create({
      data: {
        name,
        description,
        price,
        inventory: {
          create: {
            totalStock: initialStock,
            availableStock: initialStock,
          },
        },
      },
      include: {
        inventory: true,
      },
    });

    // 2. Đồng bộ số lượng tồn kho lên Redis để chuẩn bị đón flash sale
    // Key Redis dạng: product:stock:<id>
    const redis = this.redisService.getClient();
    await redis.set(`product:stock:${product.id}`, initialStock);

    return {
      message: 'Product created and inventory synced to Redis successfully',
      data: product,
    };
  }

  async findAll() {
    return this.prisma.product.findMany({
      include: { inventory: true },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { inventory: true },
    });

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    // Đọc thêm tồn kho thời gian thực từ Redis
    const redis = this.redisService.getClient();
    const stockInRedis = await redis.get(`product:stock:${id}`);

    return {
      ...product,
      realtimeStockInRedis: stockInRedis ? Number(stockInRedis) : 0,
    };
  }
}