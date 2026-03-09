import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';
import {
  PUBLIC_REGISTRATION_ROLES,
  type PublicRegistrationRole,
} from '../roles.js';

export class RegisterDto {
  @IsEmail()
  email: string;
  
  @IsString()
  @MinLength(8, {message: 'Password must be at least 8 characters long'})
  password: string;

  @IsString()
  @IsNotEmpty({message: 'First name is required'})
  name: string;

  @IsIn(PUBLIC_REGISTRATION_ROLES, {
    message: 'Role must be either OWNER or CUSTOMER',
  })
  role: PublicRegistrationRole;
}
