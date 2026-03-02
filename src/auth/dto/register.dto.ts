import {IsEmail, IsEnum, IsNotEmpty, IsString, MinLength} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;
  
  @IsString()
  @MinLength(8, {message: 'Password must be at least 8 characters long'})
  password: string;

  @IsString()
  @IsNotEmpty({message: 'First name is required'})
  name: string;

  @IsEnum(['OWNER','CUSTOMER','ADMIN'   ], {message: 'Role must be either OWNER, CUSTOMER, or ADMIN'})
  role: 'OWNER' | 'CUSTOMER' | 'ADMIN';
}