import { atom } from "recoil";

export const ProfileData = atom({
    key: "ProfileData",
    default: {
        firstName: "",
        lastName: "",
        id: 0,
        picture: "",
        nickName: "",
        username:"",
        bio: "",
        isTwoFacAuthEnabled: false,
        isTwoFacAuthVerified:false
      
        
    }
})

export const UserId = atom({
    key: "UserId",
    default: -1
})

