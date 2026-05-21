import { Sequelize } from "sequelize";
import { print } from "../../shared/utils.js";

export const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: "./pot.sqlite",
  logging: false,
});

export async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    print("Database connection established successfully", "system");

    // alter: true — безпечніше ніж force: true, не видаляє дані
    await sequelize.sync();
    print("Database models synchronized", "system");

    return true;
  } catch (error) {
    print(`Unable to connect to the database: ${error.message}`, "error");
    console.log(error)
    return false;
  }
}

export async function closeDatabase() {
  try {
    await sequelize.close();
    print("Database connection closed", "system");
  } catch (error) {
    print(`Error closing database: ${error.message}`, "error");
  }
}

export default sequelize;