import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { clearUnreadCount, getMessages, getUsersForSidebar, sendMessage } from "../controllers/message.controller.js";

const router = express.Router();

router.get("/users", protectRoute, getUsersForSidebar);
router.get("/:id", protectRoute, getMessages);

router.post("/send/:id", protectRoute, sendMessage);
router.patch("/clear-unread/:id", protectRoute, clearUnreadCount);

export default router;
