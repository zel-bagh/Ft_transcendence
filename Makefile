

all:
	docker-compose -f srcs/docker-compose.yml up --build -d
migrate: 
	./src/backend/backend-api/npx prisma migrate dev

down:
	docker-compose -f srcs/docker-compose.yml down  --remove-orphans

clean:
	docker system prune -a

fclean:

re:

.PHONY: all clean fclean re