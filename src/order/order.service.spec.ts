import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('OrderService', () => {
  let service: OrderService;
  let mockRedisClient: any;
  let mockPrismaService: any;
  let mockOrderQueue: any;

  beforeEach(async () => {
    mockRedisClient = {
      eval: jest.fn(),
      incrby: jest.fn(),
    };

    mockPrismaService = {
      order: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      product: {
        findUnique: jest.fn(),
      },
    };

    mockOrderQueue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: RedisService,
          useValue: {
            getClient: () => mockRedisClient,
          },
        },
        {
          provide: getQueueToken('order-queue'),
          useValue: mockOrderQueue,
        },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw BadRequestException when product key does not exist in Redis (-1)', async () => {
    mockRedisClient.eval.mockResolvedValue(-1);

    await expect(
      service.placeOrder({
        userId: 'user_1',
        productId: 'prod_1',
        quantity: 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw BadRequestException when out of stock (-2)', async () => {
    mockRedisClient.eval.mockResolvedValue(-2);

    await expect(
      service.placeOrder({
        userId: 'user_1',
        productId: 'prod_1',
        quantity: 2,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should SUCCEED when buying the LAST item (Lua returns 0)', async () => {
    mockRedisClient.eval.mockResolvedValue(0); // Kho còn lại 0 sau khi trừ
    mockPrismaService.product.findUnique.mockResolvedValue({
      id: 'prod_1',
      price: 100000,
    });
    mockPrismaService.order.create.mockResolvedValue({
      id: 'order_123',
      userId: 'user_1',
      totalAmount: 100000,
      status: 'PENDING',
    });
    mockOrderQueue.add.mockResolvedValue({});

    const result = await service.placeOrder({
      userId: 'user_1',
      productId: 'prod_1',
      quantity: 1,
    });

    expect(result.orderId).toBe('order_123');
    expect(result.remainingStockInRedis).toBe(0);
    expect(mockOrderQueue.add).toHaveBeenCalledWith('process-order', {
      orderId: 'order_123',
      productId: 'prod_1',
      quantity: 1,
    });
  });

  it('should rollback Redis stock when order creation fails in DB', async () => {
    mockRedisClient.eval.mockResolvedValue(4);
    mockPrismaService.product.findUnique.mockResolvedValue({
      id: 'prod_1',
      price: 100000,
    });
    mockPrismaService.order.create.mockRejectedValue(new Error('DB Connection Failed'));

    await expect(
      service.placeOrder({
        userId: 'user_1',
        productId: 'prod_1',
        quantity: 2,
      }),
    ).rejects.toThrow(InternalServerErrorException);

    // Redis phải được hoàn trả lại 2 sản phẩm
    expect(mockRedisClient.incrby).toHaveBeenCalledWith('product:stock:prod_1', 2);
  });

  it('should return existing order without decrementing stock when idempotencyKey exists', async () => {
    mockPrismaService.order.findUnique.mockResolvedValue({
      id: 'existing_order_999',
      status: 'SUCCESS',
    });

    const result = await service.placeOrder({
      userId: 'user_1',
      productId: 'prod_1',
      quantity: 1,
      idempotencyKey: 'idem_key_abc',
    });

    expect(result.orderId).toBe('existing_order_999');
    expect(mockRedisClient.eval).not.toHaveBeenCalled();
  });
});
