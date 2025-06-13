import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
    searchUsers,
    sendFriendRequest,
    getIncomingRequests,
    getOutgoingRequests,
    respondToRequest,
    listFriends
} from "../controllers/friend.controller.js";

const router = express.Router();
router.get("/search", protectRoute, searchUsers);          // ?query=Maya
router.post("/requests/:targetId", protectRoute, sendFriendRequest);
router.get("/requests/incoming", protectRoute, getIncomingRequests);
router.get("/requests/outgoing", protectRoute, getOutgoingRequests);
router.patch("/requests/:id", protectRoute, respondToRequest);
router.get("/", protectRoute, listFriends);
export default router;
